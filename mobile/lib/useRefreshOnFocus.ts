import { useCallback, useRef } from "react";
import { useFocusEffect } from "expo-router";

export function useRefreshOnFocus(reload: () => void) {
  const first = useRef(true);
  useFocusEffect(useCallback(() => {
    if (first.current) first.current = false;
    else reload();
  }, [reload]));
}
