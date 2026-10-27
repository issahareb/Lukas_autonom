import { createContext, useContext } from "react";
export const AppNavigationContext = createContext<() => void>(() => {});
export const useAppNavigation = () => useContext(AppNavigationContext);
