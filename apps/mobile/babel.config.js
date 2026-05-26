module.exports = function (api) {
  api.cache(true);
  return {
    presets: ['babel-preset-expo'],
    plugins: [
      [
        'module-resolver',
        {
          root: ['./src'],
          alias: { '#': './src' },
          extensions: ['.ts', '.tsx', '.js', '.jsx', '.json', '.svg'],
        },
      ],
      'react-native-reanimated/plugin', // Must be last - includes worklets in v4
    ],
  };
};
