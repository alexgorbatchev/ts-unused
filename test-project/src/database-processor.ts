import type { IReactFiberNode, UserData } from "./database-types";

export function processUserData(data: UserData): void {
  console.log(data.userId, data.userName);
}

export function checkFiber(fiber: IReactFiberNode): void {
  const ownerFiber = Reflect.get(fiber, "_debugOwner");
  const returnFiber = Reflect['get'](fiber, `return`);
  console.log(ownerFiber, returnFiber);
}
