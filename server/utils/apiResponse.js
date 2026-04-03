const { ERROR_CODES } = require('../../src/constants/errorCodes.js');

const toPayload = ({ ok, code, message, data }) => ({
  ok: Boolean(ok),
  code: Number.isFinite(Number(code)) ? Number(code) : (ok ? ERROR_CODES.SUCCESS : ERROR_CODES.SERVER_ERROR),
  message: String(message || (ok ? 'success' : 'error')),
  data: data ?? {}
});

const success = (data = {}, message = 'success', code = ERROR_CODES.SUCCESS) =>
  toPayload({ ok: true, code, message, data });

const fail = (code = ERROR_CODES.SERVER_ERROR, message = 'error', data = {}) =>
  toPayload({ ok: false, code, message, data });

const sendSuccess = (res, data = {}, message = 'success', code = ERROR_CODES.SUCCESS, status = 200) =>
  res.status(status).json(success(data, message, code));

const sendFail = (res, code = ERROR_CODES.SERVER_ERROR, message = 'error', data = {}, status = 500) =>
  res.status(status).json(fail(code, message, data));

module.exports = {
  ERROR_CODES,
  success,
  fail,
  sendSuccess,
  sendFail
};
