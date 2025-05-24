module.exports = {
  preset: 'ts-jest',
  testEnvironment: 'node',
  moduleNameMapper: {
    '^@DynamoDBHandler/(.*)$': '<rootDir>/src/DynamoDBHandler/$1',
    '^@LLMSummarize/(.*)$': '<rootDir>/src/LLMSummarize/$1',
    '^@NationalDietRecord/(.*)$': '<rootDir>/src/NationalDietRecord/$1',
    '^@services/(.*)$': '<rootDir>/src/services/$1',
    '^@interfaces/(.*)$': '<rootDir>/src/interfaces/$1',
  },
  transform: {
    '^.+\\.tsx?$': 'ts-jest',
  },
  transformIgnorePatterns: ['<rootDir>/node_modules/'],
};
