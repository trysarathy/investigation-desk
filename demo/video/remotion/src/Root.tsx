import React from "react";
import { Composition, Still } from "remotion";
import { Film, Thumbnail, type Timeline } from "./Film";

// Placeholder until --props supplies the generated timeline (see demo/video/README.md).
const EMPTY: Timeline = { fps: 30, duration: 1, frames: 30, cut: "full", scenes: [], captions: [], lines: [] };

export const Root: React.FC = () => (
  <>
    <Composition id="Film" component={Film} durationInFrames={EMPTY.frames} fps={30} width={1920} height={1080}
      defaultProps={{ timeline: EMPTY }}
      calculateMetadata={({ props }) => ({ durationInFrames: props.timeline.frames, fps: props.timeline.fps })} />
    <Composition id="FilmVertical" component={Film} durationInFrames={EMPTY.frames} fps={30} width={1080} height={1920}
      defaultProps={{ timeline: EMPTY }}
      calculateMetadata={({ props }) => ({ durationInFrames: props.timeline.frames, fps: props.timeline.fps })} />
    <Still id="Thumbnail" component={Thumbnail} width={1920} height={1080} />
  </>
);
