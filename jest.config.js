module.exports = {
  preset: 'ts-jest',
  testEnvironment: 'node',
  moduleNameMapper: {
    '^@DynamoDBHandler/(.*)$': '<rootDir>/src/DynamoDBHandler/$1',
    '^@GeminiHandler/(.*)$': '<rootDir>/src/GeminiHandler/$1',
    '^@NationalDietAPIHandler/(.*)$': '<rootDir>/src/NationalDietAPIHandler/$1',
    '^@services/(.*)$': '<rootDir>/src/services/$1',
    '^@interfaces/(.*)$': '<rootDir>/src/interfaces/$1',
  },
  transform: {
    '^.+\\.tsx?$': 'ts-jest',
  },
  transformIgnorePatterns: ['<rootDir>/node_modules/'],
};
