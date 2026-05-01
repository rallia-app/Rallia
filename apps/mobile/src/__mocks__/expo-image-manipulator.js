const SaveFormat = { JPEG: 'jpeg', PNG: 'png', WEBP: 'webp' };

const manipulateAsync = jest.fn().mockResolvedValue({
  uri: 'file:///tmp/compressed.jpg',
  width: 1920,
  height: 1080,
});

module.exports = { manipulateAsync, SaveFormat };
