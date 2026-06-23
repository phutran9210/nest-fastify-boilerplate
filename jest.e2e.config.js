module.exports = {
  moduleFileExtensions: ['js', 'mjs', 'json', 'ts'],
  rootDir: '.',
  roots: ['<rootDir>/test/e2e'],
  testRegex: '.*\\.e2e-spec\\.ts$',
  transform: { '^.+\\.(t|j)sx?$': '@swc/jest', '^.+\\.mjs$': '@swc/jest' },
  // better-auth pulls a deep tree of ESM-only deps (@noble/hashes, better-call, etc.).
  // Transform everything in node_modules so @swc/jest transpiles ESM → CJS.
  // This is slower on first run but Jest caches the transforms.
  transformIgnorePatterns: [],
  moduleNameMapper: {
    '^@common/(.*)$': '<rootDir>/src/common/$1',
    '^@core/(.*)$': '<rootDir>/src/core/$1',
    '^@modules/(.*)$': '<rootDir>/src/modules/$1',
    '^@generated/(.*)$': '<rootDir>/src/generated/$1',
    // Prisma 7 generates ESM-style .js imports that reference .ts source files.
    '^(\\.{1,2}/.*)\\.js$': '$1',
  },
  testEnvironment: 'node',
};
