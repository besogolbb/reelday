import { Composition } from "remotion";
import { DemoWall, FPS, SLIDE_FRAMES, SLIDES } from "./DemoWall";
import { HowItWorks, TOTAL_FRAMES as HIW_FRAMES, FPS as HIW_FPS } from "./HowItWorks";
import { Pricing } from "./Pricing";
import { WallReactions, TOTAL_FRAMES as WR_FRAMES, FPS as WR_FPS } from "./WallReactions";
import { WallPollDemo, TOTAL_FRAMES as WPD_FRAMES, FPS as WPD_FPS } from "./WallPollDemo";

export const Root = () => {
  return (
    <>
      <Composition
        id="DemoWall"
        component={DemoWall}
        durationInFrames={SLIDE_FRAMES * SLIDES.length}
        fps={FPS}
        width={1920}
        height={1080}
      />
      <Composition
        id="HowItWorks"
        component={HowItWorks}
        durationInFrames={HIW_FRAMES}
        fps={HIW_FPS}
        width={1080}
        height={1350}
      />
      <Composition
        id="Pricing"
        component={Pricing}
        durationInFrames={1}
        fps={30}
        width={1080}
        height={1350}
      />
      <Composition
        id="WallPollDemo"
        component={WallPollDemo}
        durationInFrames={WPD_FRAMES}
        fps={WPD_FPS}
        width={1920}
        height={1080}
      />
      <Composition
        id="WallPollDemoVertical"
        component={WallPollDemo}
        durationInFrames={WPD_FRAMES}
        fps={WPD_FPS}
        width={1080}
        height={1920}
      />
      <Composition
        id="WallReactions"
        component={WallReactions}
        durationInFrames={WR_FRAMES}
        fps={WR_FPS}
        width={1080}
        height={1350}
      />
    </>
  );
};
