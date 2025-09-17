const CoverDevice = require('./devices/CoverDevice');
const SwitchDevice = require('./devices/SwitchDevice');

class DeviceFactory {
  static async create(device, api) {
    const profile = device.getSetting("profile") || "switch";

    switch (profile) {
      case "cover":
        return new CoverDevice(device, api);
      case "switch":
        return new SwitchDevice(device, api);
      default:
        device.error(`Unknown profile: ${profile}, using switch as fallback`);
        return new SwitchDevice(device, api);
    }
  }

  static getCapabilities(profile) {
    switch (profile) {
      case "cover":
        return [
          "windowcoverings_set",
          "windowcoverings_state",
          "measure_power",
          "measure_current"
        ];
      case "switch":
      default:
        return [
          "onoff",
          "measure_power",
          "measure_current"
        ];
    }
  }
}

module.exports = DeviceFactory;
