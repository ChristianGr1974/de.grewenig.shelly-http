'use strict';

const Homey = require('homey');
const DeviceDiscovery = require('../../lib/deviceDiscovery');
const DeviceFactory = require("../../lib/deviceFactory");

module.exports = class MyDriver extends Homey.Driver {

  /**
   * onInit is called when the driver is initialized.
   */
  async onInit() {
    this.log("Shelly Gen2 Driver initialized");
  }

  async onPairListDevices() {
    try {
      const discovery = new DeviceDiscovery(this.homey);
      const devices = await discovery.discoverDevices();

      //this.log('Discovered devices:', devices);
      //for (const dev of devices) {
//        this.log(`Device found: ${dev.name} at ${dev.ip} with profile ${dev.profile}`);
      //}


      return devices.map(dev => {
        // Factory liefert passende Capabilities für Profil
        const capabilities = DeviceFactory.getCapabilities ? DeviceFactory.getCapabilities(dev.profile) : [];

        this.log(`Device ${dev.name} has profile ${dev.profile} with capabilities`, capabilities);

        return {
          name: dev.name,
          data: { id: dev.id, ip: dev.ip },
          settings: { ip: dev.ip, profile: dev.profile },
          icon: dev.icon,
          capabilities
        };
      });

    } catch (err) {
      this.error('Device discovery failed:', err);
      return [];
    }
  }
};
