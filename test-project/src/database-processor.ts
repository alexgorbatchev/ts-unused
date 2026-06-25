import type { IReactFiberNode, UserData } from "./database-types";

export function processUserData(data: UserData): void {
  console.log(data.userId, data.userName);
}

export function checkFiber(fiber: IReactFiberNode): void {
  const ownerFiber = Reflect.get(fiber, "_debugOwner");
  const returnFiber = Reflect['get'](fiber, `return`);
  console.log(ownerFiber, returnFiber);
}

// TODO implement dynamic sync later
export function syncDatabase(): void {
  console.log("synced");
}

// @ts-unused-ignore expected to be used by dynamic plugins
export function dynamicHook(): void {
  console.log("hook");
}
