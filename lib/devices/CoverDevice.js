"use strict";

const BaseDevice = require('./BaseDevice');

class CoverDevice extends BaseDevice {
  async initializeCapabilities() {
    await this.device.setCapabilityValue("windowcoverings_state", "idle");
    
    try {
      // Get initial status
      const status = await this.api.getCoverStatus();
      if (typeof status.current_pos === "number") {
        const position = status.current_pos / 100;
        await this.device.setCapabilityValue("windowcoverings_set", position);
      }
    } catch (err) {
      this.device.error("Failed to get initial cover status:", err);
    }

    // Register capability listeners
    this.device.registerCapabilityListener('windowcoverings_set', async (value) => {
      try {
        // Convert decimal value (0-1) to percentage (0-100)
        // 0 = closed (0%), 1 = open (100%)
        const targetPos = Math.round(value * 100);
        await this.api.coverGoToPosition(targetPos);
        return true;
      } catch (err) {
        this.device.error('Failed to set cover position:', err);
        throw err;
      }
    });

    // Add listeners for up/down/stop controls
    this.device.registerCapabilityListener('windowcoverings_state', async (value) => {
      try {
        switch (value) {
          case 'up':
            await this.api.coverOpen();
            break;
          case 'down':
            await this.api.coverClose();
            break;
          case 'idle':
            await this.api.coverStop();
            break;
        }
        return true;
      } catch (err) {
        this.device.error('Failed to control cover:', err);
        throw err;
      }
    });
  }

  async handleNotification(data) {
    this.device.log('Received notification:', JSON.stringify(data));
    
    // Handle new format notifications with 'updates'
    if (data.updates?.cover?.["0"]) {
      const coverData = data.updates.cover["0"];
      if (coverData.state) {
        const state = this.mapCoverState(coverData.state);
        await this.setCapabilityValueSafe("windowcoverings_state", state);
      }
      
      if (typeof coverData.current_pos === "number") {
        const position = coverData.current_pos / 100;
        await this.setCapabilityValueSafe("windowcoverings_set", position);
      }

      // Handle power measurements
      if (typeof coverData.apower === "number") {
        await this.setCapabilityValueSafe("measure_power", coverData.apower);
      }
      
      if (typeof coverData.current === "number") {
        await this.setCapabilityValueSafe("measure_current", coverData.current);
      }
    }  
    
    // Cover event
    if (data.event && data.event.component === "cover:0") {
      if (data.event.event === "start") {
        const state = data.event.direction === "open" ? "up" : "down";
        await this.device.setCapabilityValue("windowcoverings_state", state).catch(this.device.error);
      } else if (data.event.event === "stop") {
        await this.device.setCapabilityValue("windowcoverings_state", "idle").catch(this.device.error);
      }
    }
  }

  mapCoverState(state) {
    switch (state) {
      case "opening": return "up";
      case "closing": return "down";
      case "stopped": return "idle";
      default: return "idle";
    }
  }
}

module.exports = CoverDevice;