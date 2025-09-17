"use strict";

const Homey = require("homey");

class MyApp extends Homey.App {
  async onInit() {
    this.log("Shelly Gen2 App gestartet");
  }
}

module.exports = MyApp;
