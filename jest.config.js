module.exports = {
  moduleFileExtensions: ['js', 'json', 'ts'],
  rootDir: '.',
  // Test tách khỏi source: unit ở test/unit/ (mirror src/), e2e ở test/e2e/.
  roots: ['<rootDir>/test'],
  testRegex: '.*\\.spec\\.ts$',
  transform: { '^.+\\.(t|j)s$': '@swc/jest' },
  // Alias trỏ vào source dưới src/.
  moduleNameMapper: {
    '^@common/(.*)$': '<rootDir>/src/common/$1',
    '^@core/(.*)$': '<rootDir>/src/core/$1',
    '^@modules/(.*)$': '<rootDir>/src/modules/$1',
    '^@generated/(.*)$': '<rootDir>/src/generated/$1',
  },
  testEnvironment: 'node',
};
