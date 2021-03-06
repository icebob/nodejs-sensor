'use strict';

var pidStore = require('../pidStore');

exports.payloadPrefix = 'pid';
exports.currentPayload = pidStore.pid;

pidStore.onPidChange(function(pid) {
  exports.currentPayload = pid;
});

exports.activate = function() {};
exports.deactivate = function() {};
