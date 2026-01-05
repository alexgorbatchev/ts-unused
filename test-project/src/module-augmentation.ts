// This file demonstrates module augmentation which should be ignored
// when ignoreModuleAugmentations is true (default)

// Augment express with additional properties on Request
declare module "express" {
  interface Request {
    userId?: string;
    sessionId?: string;
  }
}

// Augment some-library with additional interfaces
declare module "some-library" {
  export interface ExtendedOptions {
    customField: string;
  }
}

// Regular export that IS used
export function setupAugmentations(): void {
  console.log("Setting up module augmentations");
}
