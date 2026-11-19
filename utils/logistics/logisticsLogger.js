// src/services/logistics/logisticsLogger.js
export const logisticsLogger = {
  info: (message, meta = {}) => {
    console.log([LOGISTICS][INFO] , meta);
  },
  warn: (message, meta = {}) => {
    console.warn([LOGISTICS][WARN] , meta);
  },
  error: (message, meta = {}) => {
    console.error([LOGISTICS][ERROR] , meta);
  },
};
export default logisticsLogger;

