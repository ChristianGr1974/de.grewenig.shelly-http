"use strict";

const BaseDevice = require('./BaseDevice');

class SwitchDevice extends BaseDevice {
  async initializeCapabilities() {
    await this.device.setCapabilityValue("onoff", false);

    // Get the channel number from the device ID (e.g., "abc123_switch:1" -> 1)
    const deviceId = this.device.getData().id;
    this.channelNumber = parseInt(deviceId.split(':')[1]);

    // Initialize device

    try {
      // Get initial status
      const status = await this.api.getSwitchStatus(this.channelNumber);
      if (typeof status.output === "boolean") {
        await this.device.setCapabilityValue("onoff", status.output);
      }
    } catch (err) {
      this.device.error("Failed to get initial switch status:", err);
    }

    // Register capability listeners
    this.device.registerCapabilityListener('onoff', async (value) => {
      try {
        await this.api.switchSet(value, this.channelNumber);
        return true;
      } catch (err) {
        this.device.error('Failed to set switch state:', err);
        throw err;
      }
    });
  }


  async handleNotification(data) {
    //console.log('Received notification:', JSON.stringify(data));
    
    // Check if we have switch updates for our channel
    if (data.updates.switch && data.updates.switch[this.channelNumber]) {
      const switchState = data.updates.switch[this.channelNumber];
      
      if (typeof switchState.output === "boolean") {
        await this.setCapabilityValueSafe("onoff", switchState.output);
      }

      // Handle power measurements
      if (typeof switchState.apower === "number") {
        await this.setCapabilityValueSafe("measure_power", switchState.apower);
      }
      
      if (typeof switchState.current === "number") {
        await this.setCapabilityValueSafe("measure_current", switchState.current);
      }
    }
  }
}

module.exports = SwitchDevice;