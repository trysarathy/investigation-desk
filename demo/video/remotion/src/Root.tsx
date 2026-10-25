import React from "react";
import { Composition, Still } from "remotion";
import { Story, StoryThumb, type StoryTimeline } from "./Story";

// Placeholder until --props supplies the generated timeline (see demo/video/README.md).
const EMPTY: StoryTimeline = { fps: 30, duration: 1, frames: 30, cut: "full", scenes: [{ kind: "end", from: 0, to: 1, at: 0 }], captions: [], lines: [] };
const meta = ({ props }: { props: { timeline: StoryTimeline } }) => ({ durationInFrames: props.timeline.frames, fps: props.timeline.fps });

export const Root: React.FC = () => (
  <>
    <Composition id="Story" component={Story} durationInFrames={30} fps={30} width={1920} height={1080} defaultProps={{ timeline: EMPTY }} calculateMetadata={meta} />
    <Composition id="StoryVertical" component={Story} durationInFrames={30} fps={30} width={1080} height={1920} defaultProps={{ timeline: EMPTY }} calculateMetadata={meta} />
    <Still id="StoryThumb" component={StoryThumb} width={1920} height={1080} />
  </>
);
