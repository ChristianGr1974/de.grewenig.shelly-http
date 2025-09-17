"use strict";

class BaseDevice {
  constructor(device, api) {
    this.device = device;
    this.api = api;
  }

  async init() {
    this.device.log(`Initializing ${this.constructor.name} for ${this.device.getName()}`);

    try {
      // Connect WebSocket and set up notification handler
      await this.api.connect();
      this.api.setNotificationHandler(this.handleNotification.bind(this));
      //this.device.log(`WebSocket connected to Shelly @ ${this.api.ip}`);

      // Set device as available
      await this.device.setAvailable();

      // Initialize device-specific capabilities
      await this.initializeCapabilities();

    } catch (err) {
      this.device.error("Error during initialization:", err);
      throw err;
    }
  }

  /**
   * Initialize device-specific capabilities
   * To be implemented by child classes
   */
  async initializeCapabilities() {
    throw new Error("initializeCapabilities must be implemented by child class");
  }

  /**
   * Handle notifications from the device
   * To be implemented by child classes
   */
  async handleNotification(data) {
    throw new Error("handleNotification must be implemented by child class");
  }

  /**
   * Safely set a capability value with error handling
   */
  async setCapabilityValueSafe(capability, value) {
    try {
      await this.device.setCapabilityValue(capability, value);
    } catch (err) {
      if (err.statusCode === 404) {
        // Device not found - likely deleted. Disconnect WebSocket.
        this.device.error('Device not found in Homey, disconnecting WebSocket');
        if (this.api) {
          this.api.disconnect();
        }
      } else {
        this.device.error(`Failed to set capability ${capability}:`, err);
      }
    }
  }

  /**
   * Cleanup when device is destroyed
   */
  async destroy() {
    if (this.api) {
      this.api.removeNotificationHandler(this.handleNotification.bind(this));
      this.api.disconnect();
    }
  }
}

module.exports = BaseDevice;