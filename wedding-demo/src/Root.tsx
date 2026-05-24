import React from "react";
import { Composition } from "remotion";
import { WeddingWallDemo } from "./WeddingWallDemo";

export const Root: React.FC = () => {
  return (
    <Composition
      id="WeddingWallDemo"
      component={WeddingWallDemo}
      durationInFrames={840}
      fps={30}
      width={1080}
      height={1920}
    />
  );
};
