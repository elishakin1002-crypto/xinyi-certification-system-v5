/*
  必须在 require app.js **之前**设环境变量。
  app.js 在模块级就把这些读成了常量，require 之后再改 process.env 已经晚了。
  变量本身（含测试库地址）统一由 testDb.js 提供，见那里的说明。
*/
const { testEnv } = require('./testDb');
Object.assign(process.env, testEnv());

const app = require('../../server/app.js');

const startServer = () =>
  new Promise((resolve, reject) => {
    const server = app.listen(0, '127.0.0.1', () => resolve(server));
    server.on('error', reject);
  });

const stopServer = (server) =>
  new Promise((resolve, reject) => {
    server.close((err) => (err ? reject(err) : resolve()));
  });

const getBaseUrl = (server) => {
  const address = server.address();
  if (!address || typeof address !== 'object') {
    throw new Error('Server address is unavailable');
  }
  return `http://127.0.0.1:${address.port}`;
};

module.exports = {
  startServer,
  stopServer,
  getBaseUrl
};
