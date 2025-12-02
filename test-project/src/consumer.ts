import { USED_CONSTANT, UsedClass, type UsedInterface, type UsedType, usedFunction, usedVariable } from "./sample";
import {
  alwaysFails,
  alwaysSucceeds,
  asyncAlwaysSucceeds,
  neverWarns,
  onlyReturnsString,
  returnsAll,
  sometimesSucceeds,
} from "./return-types";

export function consumer(): void {
  usedFunction();
  console.log(USED_CONSTANT);

  const obj1: UsedInterface = {
    usedProperty: "test",
  };

  const obj2: UsedType = {
    usedField: "test",
  };

  console.log(obj1.usedProperty);
  console.log(obj2.usedField);

  const instance = new UsedClass("test");
  console.log(instance.name);

  console.log(usedVariable);

  // Use return-types functions
  console.log(alwaysSucceeds());
  console.log(alwaysFails());
  console.log(sometimesSucceeds(true));
  asyncAlwaysSucceeds().then(console.log);
  console.log(neverWarns());
  console.log(onlyReturnsString());
  console.log(returnsAll());
}
