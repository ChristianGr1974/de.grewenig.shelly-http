'use strict';

const WebSocket = require('ws');

const CONFIG = {
  REQUEST_TIMEOUT: 5000,
  RETRY_DELAY: 1000,
  RETRYABLE_ERRORS: ['EHOSTUNREACH', 'ETIMEDOUT', 'ECONNREFUSED']
};

/**
 * Class representing a Shelly device API
 */
class ShellyApi {
  /**
   * Create a ShellyApi instance
   * @param {string} ip - The IP address of the Shelly device
   * @param {string} deviceId - The Homey device ID to use as src in requests
   */
  constructor(ip, deviceId) {
    this.ip = ip;
    this.deviceId = deviceId;
    this.wsUrl = `ws://${ip}/rpc`;
    this.ws = null;
    this.isConnected = false;
    this.messageId = 1;
    this.pendingRequests = new Map();
    this.notificationHandler = null;
  }

  /**
   * @private
   * Log messages with device context
   */
  log(message, ...args) {
    console.log(`[ShellyApi ${this.ip}] ${message}`, ...args);
  }

  /**
   * @private
   * Log error messages with device context
   */
  error(message, ...args) {
    console.error(`[ShellyApi ${this.ip}] ${message}`, ...args);
  }

  /**
   * Connect to the device via WebSocket
   * @returns {Promise<void>}
   */
  connect() {
    if (this.ws) {
      return Promise.resolve();
    }

    return new Promise((resolve, reject) => {
      this.ws = new WebSocket(this.wsUrl);
      //this.log('Attempting to establish WebSocket connection... URL:', this.wsUrl);

      this.ws.on('open', async () => {
        //this.log('WebSocket connection established');
        this.isConnected = true;
        
        // First send a status request to enable notifications
        try {
          await this.getStatus();          
        } catch (error) {
          this.error('Failed to send initial status request:', error);
        }
        
        resolve();
      });

      this.ws.on('message', (data) => {
        //this.log('WebSocket message received:', data.toString());
        const message = JSON.parse(data.toString());
        this.handleMessage(message);
      });

      this.ws.on('close', () => {
        this.isConnected = false;
        this.ws = null;
        //this.log('Connection closed');
      });

      this.ws.on('error', (err) => this.handleError(err, reject));
    });
  }

  /**
   * @private
   * Handle incoming WebSocket messages
   */
  handleMessage(message) {
    if (message.method === 'NotifyStatus' || message.method === 'NotifyEvent') {
      this.handleNotification(message);
    } else if (message.id) {
      this.handleRpcResponse(message);
    }
  }

  /**
   * @private
   * Handle notifications from the device
   */
  handleNotification(message) {
    // Check if this notification is for this specific device instance
    if (message.dst && message.dst !== this.deviceId) {
      // This notification is for a different device instance on the same Shelly
      return;
    }

    console.log('----------------------------------------------------------------------');
    console.log(`Received notification (${this.deviceId}): ${JSON.stringify(message)}`);
    const { params } = message;
    const timestamp = params.ts;
    const updates = {};

    for (const [key, value] of Object.entries(params)) {
      if (key !== 'ts') {
        const [component, id] = key.split(':');
        updates[component] = updates[component] || {};
        updates[component][id] = value;
      }
    }

    if (this.notificationHandler) {
      try {
        this.notificationHandler({ timestamp, updates });
      } catch (err) {
        this.log('Error in notification handler:', err);
      }
    }
  }

  /**
   * @private
   * Handle RPC responses
   */
  handleRpcResponse(message) {
    const resolver = this.pendingRequests.get(message.id);
    if (resolver) {
      this.pendingRequests.delete(message.id);
      if (message.error) {
        resolver.reject(new Error(`RPC Error ${message.error.code}: ${message.error.message}`));
      } else {
        resolver.resolve(message.result);
      }
    }
  }

  /**
   * @private
   * Handle WebSocket connection errors
   */
  handleError(err, reject) {
    this.cleanupWebSocket();

    const isNotShellyResponse = err.message.includes('404') ||
      err.message.includes('Unexpected server response');

    let enhancedError;
    if (isNotShellyResponse) {
      enhancedError = new Error('Device discovery: not a Shelly device');
      enhancedError.code = 'NOT_SHELLY_DEVICE';
    } else if (err.code) {
      enhancedError = new Error('Device discovery: connection failed');
      enhancedError.code = err.code;
    } else {
      enhancedError = new Error('Device discovery: connection failed');
      enhancedError.code = 'CONNECTION_FAILED';
    }

    if (global.DEBUG) {
      this.log('Debug:', enhancedError.message, err.code || err.message);
    }

    reject(enhancedError);
  }

  /**
   * Send a request to the device
   * @param {string} method - RPC method to call
   * @param {Object} [params] - Method parameters
   * @param {number} [retries] - Number of retries
   * @returns {Promise<any>}
   */
  async request(method, params = {}, retries = 1) {
    try {
      if (!this.isConnected) {
        await this.connect();
      }      
      
      const message = {
        jsonrpc: "2.0",
        id: this.messageId++,  // We still need a unique message ID for tracking responses
        src: this.deviceId || 'homey_default',  // Ensure src is never undefined
        method,
        params
      };

      return new Promise((resolve, reject) => {
        const msgId = this.messageId - 1;  // Use the message ID we just incremented
        const timeoutId = setTimeout(() => {
          this.pendingRequests.delete(msgId);
          reject(new Error('REQUEST_TIMEOUT'));
        }, CONFIG.REQUEST_TIMEOUT);

        this.pendingRequests.set(msgId, {
          resolve: (result) => {
            clearTimeout(timeoutId);
            resolve(result);
          },
          reject: (error) => {
            clearTimeout(timeoutId);
            reject(error);
          }
        });

        try {
          var msg = JSON.stringify(message);
          console.log('Sending message:', msg);
          this.ws.send(msg);
        } catch (err) {
          clearTimeout(timeoutId);
          this.pendingRequests.delete(id);
          
          if (retries > 0 && CONFIG.RETRYABLE_ERRORS.includes(err.code)) {
            setTimeout(() => {
              this.request(method, params, retries - 1)
                .then(resolve)
                .catch(reject);
            }, CONFIG.RETRY_DELAY);
          } else {
            reject(err);
          }
        }
      });
    } catch (err) {
      if (retries > 0 && CONFIG.RETRYABLE_ERRORS.includes(err.code)) {
        await new Promise(resolve => setTimeout(resolve, CONFIG.RETRY_DELAY));
        return this.request(method, params, retries - 1);
      }
      throw err;
    }
  }

  /**
   * Get device information
   * @returns {Promise<Object>}
   */
  getDeviceInfo() {
    return this.request('Shelly.GetDeviceInfo');
  }

  /**
   * Get device status
   * @returns {Promise<Object>}
   */
  getStatus() {
    return this.request('Shelly.GetStatus');
  }

  /**
   * Get status of a specific cover
   * @param {number} [id=0] - Cover ID
   * @returns {Promise<Object>} Cover status including position, state, and power info
   */
  getCoverStatus(id = 0) {
    return this.request('Cover.GetStatus', { id });
  }

  /**
   * Move cover to a specific position
   * @param {number} pos - Position to move to (0-100)
   * @param {number} id - Cover ID (default 0) 
   * @returns {Promise<Object>}
   */
  async coverGoToPosition(pos, id = 0) {
    return this.request('Cover.GoToPosition', { id, pos });
  }

  /**
   * Open the cover
   * @param {number} id - Cover ID (default 0)
   * @returns {Promise<Object>}
   */
  coverOpen(id = 0) {
    return this.request('Cover.Open', { id });
  }

  /**
   * Close the cover
   * @param {number} id - Cover ID (default 0)
   * @returns {Promise<Object>}
   */
  coverClose(id = 0) {
    return this.request('Cover.Close', { id });
  }

  /**
   * Stop the cover
   * @param {number} id - Cover ID (default 0)
   * @returns {Promise<Object>}
   */
  coverStop(id = 0) {
    return this.request('Cover.Stop', { id });
  }

  /**
   * Get status of a specific switch
   * @param {number} [id=0] - Switch ID
   * @returns {Promise<Object>} Switch status including state and power info
   */
  getSwitchStatus(id = 0) {
    return this.request('Switch.GetStatus', { id });
  }

  /**
   * Set switch state
   * @param {boolean} on - True to turn on, false to turn off
   * @param {number} [id=0] - Switch ID
   * @returns {Promise<Object>}
   */
  switchSet(on, id = 0) {
    return this.request('Switch.Set', { id, on });
  }

  /**
   * Get device status including available components
   * This request also enables notifications as it provides a valid src
   * @returns {Promise<Object>} Device status including all components
   */
  async getStatus() {
    return this.request('Shelly.GetStatus');
  }

  /**
   * Set the notification handler
   * @param {Function} handler - The handler function
   */
  setNotificationHandler(handler) {
    this.notificationHandler = handler;
  }

  /**
   * Clean up WebSocket connection
   * @private
   */
  cleanupWebSocket() {
    if (this.ws) {
      this.ws.terminate();
      this.ws = null;
      this.isConnected = false;
    }
  }

  /**
   * Disconnect from the device
   */
  disconnect() {
    this.cleanupWebSocket();
  }
}

module.exports = ShellyApi;