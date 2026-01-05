// Declare external modules that we want to augment in test-project
// These don't have actual implementations, just type declarations for testing

declare module "express" {
  interface Request {}
}

declare module "some-library" {}
