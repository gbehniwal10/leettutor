import React, { useRef, useCallback, useEffect, useState } from "react";
import { createRoot } from "react-dom/client";
import { Excalidraw, exportToBlob } from "@excalidraw/excalidraw";
import "@excalidraw/excalidraw/index.css";
import { DS_LIBRARY_ITEMS } from "./ds-library.js";

function getExcalidrawTheme() {
  const theme = document.documentElement.getAttribute("data-theme");
  return theme === "sepia" ? "light" : "dark";
}

function ExcalidrawIsland() {
  const excalidrawApiRef = useRef(null);
  const onChangeCallbackRef = useRef(null);
  const [theme, setTheme] = useState(getExcalidrawTheme);

  // Sync theme with app's data-theme attribute
  useEffect(() => {
    const observer = new MutationObserver(() => {
      setTheme(getExcalidrawTheme());
    });
    observer.observe(document.documentElement, {
      attributes: true,
      attributeFilter: ["data-theme"],
    });
    return () => observer.disconnect();
  }, []);

  // Expose bridge API for vanilla JS
  useEffect(() => {
    window.excalidrawBridge = {
      exportToPng: async () => {
        const api = excalidrawApiRef.current;
        if (!api) return null;
        const elements = api.getSceneElements().filter((el) => !el.isDeleted);
        if (elements.length === 0) return null;
        return exportToBlob({
          elements,
          appState: { ...api.getAppState(), exportWithDarkMode: theme === "dark" },
          files: api.getFiles(),
        });
      },
      getElementCount: () => {
        const api = excalidrawApiRef.current;
        if (!api) return 0;
        return api.getSceneElements().filter((el) => !el.isDeleted).length;
      },
      clear: () => {
        const api = excalidrawApiRef.current;
        if (!api) return;
        api.resetScene();
      },
      getState: () => {
        const api = excalidrawApiRef.current;
        if (!api) return null;
        const elements = api.getSceneElements().filter((el) => !el.isDeleted);
        if (elements.length === 0) return null;
        const files = api.getFiles();
        const usedFileIds = new Set(
          elements.filter((el) => el.type === "image" && el.fileId).map((el) => el.fileId)
        );
        const filteredFiles = {};
        for (const [id, file] of Object.entries(files)) {
          if (usedFileIds.has(id)) filteredFiles[id] = file;
        }
        return {
          elements,
          files: Object.keys(filteredFiles).length > 0 ? filteredFiles : undefined,
        };
      },
      restoreState: (stateData) => {
        const api = excalidrawApiRef.current;
        if (!api || !stateData) return;
        if (stateData.files) {
          api.addFiles(
            Object.entries(stateData.files).map(([id, file]) => ({ ...file, id }))
          );
        }
        api.updateScene({ elements: stateData.elements || [] });
      },
      setOnChangeCallback: (cb) => {
        onChangeCallbackRef.current = cb;
      },
    };
    return () => {
      delete window.excalidrawBridge;
    };
  }, [theme]);

  const onExcalidrawApi = useCallback((api) => {
    excalidrawApiRef.current = api;
  }, []);

  const handleChange = useCallback(() => {
    if (onChangeCallbackRef.current) {
      onChangeCallbackRef.current();
    }
  }, []);

  return (
    <Excalidraw
      excalidrawAPI={onExcalidrawApi}
      theme={theme}
      onChange={handleChange}
      initialData={{ libraryItems: DS_LIBRARY_ITEMS }}
      UIOptions={{
        canvasActions: {
          loadScene: false,
          export: false,
          saveToActiveFile: false,
          saveAsImage: false,
        },
      }}
    />
  );
}

const rootEl = document.getElementById("excalidraw-root");
if (rootEl) {
  const root = createRoot(rootEl);
  root.render(<ExcalidrawIsland />);
}
