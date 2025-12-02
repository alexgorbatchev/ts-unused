// Types defined in this module
export interface LocalSuccess {
  success: true;
  data: string;
}

export interface LocalError {
  success: false;
  error: string;
}

export type LocalResult = LocalSuccess | LocalError;
