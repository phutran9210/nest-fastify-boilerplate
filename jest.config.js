module.exports = {
  moduleFileExtensions: ['js', 'json', 'ts'],
  rootDir: 'src',
  testRegex: '.*\\.spec\\.ts$',
  transform: { '^.+\\.(t|j)s$': '@swc/jest' },
  // rootDir = src, nên alias trỏ thẳng vào các thư mục con của src.
  moduleNameMapper: {
    '^@common/(.*)$': '<rootDir>/common/$1',
    '^@core/(.*)$': '<rootDir>/core/$1',
    '^@modules/(.*)$': '<rootDir>/modules/$1',
    '^@generated/(.*)$': '<rootDir>/generated/$1',
  },
  testEnvironment: 'node',
};
