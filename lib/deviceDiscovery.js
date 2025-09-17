'use strict';

const ShellyApi = require('./shellyApi');

/**
 * Handles discovery of Shelly devices in the local network
 */
class DeviceDiscovery {
  constructor(homey) {
    this.homey = homey;
    this.DISCOVERY_TIMEOUT = 30000;  // 30 seconds total discovery time
    this.SCAN_BATCH_SIZE = 20;       // Smaller batch size for reliability
    this.CONNECTION_TIMEOUT = 1500;   // 1.5 seconds per device timeout
  }

  /**
   * Discover Shelly devices in the local network
   * @returns {Promise<Array>} Array of discovered devices with their channels
   */
  async discoverDevices() {
    try {
      const localAddress = await this.homey.cloud.getLocalAddress();
      const baseIp = localAddress.split('.').slice(0, 3).join('.');
      const ipRange = this._generateIpRange(baseIp);
      const discoveredDevices = [];

      console.log('Starting network scan on network:', baseIp);
      
      // Create a controller for the discovery process
      const controller = new AbortController();
      const timeoutId = setTimeout(() => {
        controller.abort();
      }, this.DISCOVERY_TIMEOUT);

      try {
        await this._scanNetworkInBatches(ipRange, discoveredDevices, controller.signal);
        clearTimeout(timeoutId);
        console.log('Network scan complete, found:', discoveredDevices.length, 'devices');
      } catch (err) {
        clearTimeout(timeoutId);
        if (err.name === 'AbortError') {
          console.log('Network scan partially complete, found:', discoveredDevices.length, 'devices');
        } else {
          throw err;
        }
      }

      return discoveredDevices;
    } catch (err) {
      console.error('Discovery failed:', err);
      return [];
    }
  }

  /**
   * Generate list of IPs to scan based on network base IP
   * @private
   */
  _generateIpRange(baseIp) {
    const ipRange = [];    
    console.log('Generating IP range for network:', baseIp);
    
    // Scan the last octet range (1-254)
    for (let i = 1; i <= 254; i++) {
      ipRange.push(`${baseIp}.${i}`);
    }

    return ipRange;
  }

  /**
   * Scan network in batches to avoid overwhelming the network
   * @private
   */
  async _scanNetworkInBatches(ipRange, discoveredDevices, signal) {
    // Process batches of IPs concurrently
    for (let i = 0; i < ipRange.length; i += this.SCAN_BATCH_SIZE) {
      // Check if discovery was aborted
      if (signal?.aborted) {
        console.log('Discovery aborted, processed:', i, 'addresses');
        return;
      }

      const batch = ipRange.slice(i, i + this.SCAN_BATCH_SIZE);
      
      try {
        // Map each IP to a device check promise
        const promises = batch.map(ip => this._tryDevice(ip, discoveredDevices));
        
        // Wait for all promises in this batch
        const results = await Promise.allSettled(promises);
        
        // Log progress
        const completed = i + batch.length;
        const total = ipRange.length;
        const found = discoveredDevices.length;
        console.log(`Scanned ${completed}/${total} addresses, found ${found} devices`);
      } catch (err) {
        // Should never happen with allSettled, but just in case
        console.debug('Batch error (continuing):', err.message);
      }

      // Small delay between batches to prevent network flooding
      await new Promise(resolve => setTimeout(resolve, 100));
    }
  }

  /**
   * Try to connect to a potential Shelly device
   * @private
   */
  _tryDevice(ip, devices) {
    return new Promise(resolve => {
      const api = new ShellyApi(ip);
      
      // Set up connection timeout
      const timeoutId = setTimeout(() => {
        if (this.homey.app.debug) {
          console.debug(`Device discovery: timeout for ${ip}`);
        }
        resolve(null);
      }, this.CONNECTION_TIMEOUT);
      
      // Try to query the device
      this._queryDevice(api, ip, devices)
        .then(() => {
          clearTimeout(timeoutId);
          resolve(true);
        })
        .catch(err => {
          clearTimeout(timeoutId);
          if (this.homey.app.debug) {
            console.debug(`Device discovery: skipping ${ip} (${err.code || 'unknown error'})`);
          }
          resolve(null);
        });
    });
  }

  /**
   * Query a device for its information and status
   * @private
   */
  async _queryDevice(api, ip, devices) {
    try {
      // First check if device is reachable
      const info = await api.getDeviceInfo().catch(err => {
        if (err.code) {
          err.code = err.code.toUpperCase();  // Normalize error codes
        }
        throw err;
      });

      // Only get status if device info was retrieved successfully
      const status = await api.getStatus();

      //console.log(`Found Shelly device at: ${ip}\ninfo=${JSON.stringify(info)}\nstatus=${JSON.stringify(status)}`);
      
      const deviceConfig = this._parseComponents(status, info);

      //console.log(`deviceConfig for ${ip}:`, JSON.stringify(deviceConfig));

      this._createDeviceEntries(deviceConfig, info, ip, devices);
      
      console.log('Found devices:', devices.slice(-deviceConfig.covers.size - deviceConfig.switches.size).map(d => d.id));
    } catch (err) {
      // Transform error to include error code if available
      const error = new Error(`Device query failed: ${err.message}`);
      error.code = err.code;
      throw error;
    }
  }

  /**
   * Parse device status to extract components and their channels
   * @private
   */
  _parseComponents(status, info) {
    const deviceConfig = {
      covers: {},  // { [id]: Object }
      switches: {} // { [id]: Object }
    };

    //console.log('----------------------------------------------------------------------');
    //console.log(`Parsing components for device ${info.id} with profile ${info.profile} \nwith status: ${JSON.stringify(status)} \nand info: ${JSON.stringify(info)}`);

    // Parse components based on device profile and type
    for (const [key, value] of Object.entries(status)) {
      const [component, id] = key.split(':');
      if (id === undefined) continue;
      
      const numId = parseInt(id);
      
      if (info.profile === 'cover' && component === 'cover') {
        // For cover profile, collect cover components
        deviceConfig.covers[numId] = value;
      } else if (info.profile !== 'cover' && component === 'switch') {
        // For non-cover profile, collect switch components
        deviceConfig.switches[numId] = value;
      }
    }

    //console.log('Parsed device config:', JSON.stringify(deviceConfig, null, 2));
    
    return deviceConfig;
  }

  /**
   * Create device entries for each component channel
   * @private
   */
  _createDeviceEntries(deviceConfig, info, ip, devices) {
    //console.log(`Creating device entries for ${info.app} at ${ip} with profile ${info.profile}`);

    if (info.profile === 'cover') {
      // For cover profile, create one device per pair of switches
      for (const coverId in deviceConfig.covers) {
        devices.push(this._createDeviceEntry('cover', parseInt(coverId), info, ip));
      }
    } else {
      // For switch profile, create one device per switch
      for (const switchId in deviceConfig.switches) {
        devices.push(this._createDeviceEntry('switch', parseInt(switchId), info, ip));
      }
    }
  }

  /**
   * Create a single device entry
   * @private
   */
  _createDeviceEntry(component, channel, info, ip) {
    var entry = {
      id: `${info.id}_${component}:${channel}`,
      deviceId: `${info.id}_${component}:${channel}`,
      component,
      channel,
      name: this._formatDeviceName(info.app, component, channel, ip),
      ip,
      profile: info.profile,
      icon: info.app === "Pro3" ? '/images/icon_pro3.svg' : '/images/icon.svg'
    };

    //console.log('Created device entry:', entry);

    return entry;
  }

  /**
   * Format a human-readable device name
   * @private
   */
  _formatDeviceName(app, component, channel, ip) {
    const baseName = `Shelly ${app} (${ip})`;
    
    // For inputs and switches when not in cover mode, add the component type and number
    switch (component) {
      case 'cover':
        return baseName;
      case 'switch':
      case 'input':
        return `${baseName} ${component} ${channel + 1}`;
      default:
        return `${baseName} ${component} ${channel + 1}`;
    }
  }
}

module.exports = DeviceDiscovery;