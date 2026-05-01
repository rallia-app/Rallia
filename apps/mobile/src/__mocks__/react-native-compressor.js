module.exports = {
  Video: {
    compress: jest.fn().mockResolvedValue('file:///tmp/compressed.mp4'),
  },
};
