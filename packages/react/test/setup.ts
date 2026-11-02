import { cleanup } from "@testing-library/react";
import { afterEach } from "vitest";

// React's act() environment flag, so state updates outside Testing Library helpers do not warn.
(globalThis as { IS_REACT_ACT_ENVIRONMENT?: boolean }).IS_REACT_ACT_ENVIRONMENT = true;

afterEach(() => cleanup());
