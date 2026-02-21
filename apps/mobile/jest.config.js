module.exports = {
  preset: 'jest-expo',
  setupFiles: ['./jest.setup.js'],
  moduleNameMapper: {
    '^@ki-assistent/shared$': '<rootDir>/../../packages/shared/src',
    '^@ki-assistent/shared/(.*)$': '<rootDir>/../../packages/shared/src/$1',
  },
  // pnpm-aware pattern: packages live in node_modules/.pnpm/<pkg>@ver/node_modules/<pkg>/
  transformIgnorePatterns: [
    'node_modules/(?!(?:.pnpm/)?(?:@?[^/]+/)*(?:(jest-)?react-native|@react-native(-community)?|expo(nent)?|@expo(nent)?|@expo-google-fonts|react-navigation|@react-navigation|@sentry/react-native|native-base|react-native-svg|react-native-marked|tweetnacl|react-native-safe-area-context|react-native-screens|expo-notifications|expo-device|expo-constants|@react-native-async-storage))',
  ],
  testPathIgnorePatterns: ['/node_modules/', '/dist/'],
}
