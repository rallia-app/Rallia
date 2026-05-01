module.exports = {
  readAsStringAsync: jest.fn(),
  getInfoAsync: jest.fn().mockResolvedValue({ exists: true, size: 1024 }),
  EncodingType: { Base64: 'base64', UTF8: 'utf8' },
};
