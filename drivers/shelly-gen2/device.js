'use strict';

const Homey = require('homey');
const ShellyApi = require("../../lib/shellyApi");
const DeviceFactory = require('../../lib/deviceFactory');

class ShellyGen2Device extends Homey.Device {
  async onInit() {
    this.log("Shelly Gen2 Device initialized");

    const ip = this.getSetting("ip");
    // Initialize API with IP and device ID
    this.api = new ShellyApi(ip, this.getData().id);

    // DeviceFactory erzeugt passendes Device
    this.impl = await DeviceFactory.create(this, this.api);

    // Device initialisieren
    await this.impl.init();
  }
}

module.exports = ShellyGen2Device;
