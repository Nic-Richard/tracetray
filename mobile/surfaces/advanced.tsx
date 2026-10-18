import type { AnalysisResult } from "@tracetray/shared";
import DetailsTab from "../../web/src/tabs/DetailsTab";
import { mount } from "./bridge";

mount<{ result: AnalysisResult; dark: boolean }>(props => <main className="advanced-surface"><DetailsTab result={props.result} /></main>);
