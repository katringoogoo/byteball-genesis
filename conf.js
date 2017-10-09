/*jslint node: true */
"use strict";

exports.port = null;
//exports.myUrl = 'wss://example.org/bb';
exports.bServeAsHub = false;
exports.bLight = false;

exports.storage = 'sqlite';

// headless wallet auto startup
exports.bAutoStartup = false;

exports.hub = '';
exports.deviceName = '';
exports.permanent_paring_secret = '';
exports.control_addresses = ['DEVICE ALLOWED TO CHAT'];

exports.bSingleAddress = true;
exports.THRESHOLD_DISTANCE = 50;
exports.MIN_AVAILABLE_WITNESSINGS = 100;

exports.KEYS_FILENAME = 'keys.json';

// configuration for witness initial budget
exports.witness_budget = 1000000;
exports.witness_budget_count = 10; 
