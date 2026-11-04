import { createFileRoute } from "@tanstack/react-router";
import { AllProjectsBoard } from "../components/SessionsBoard";

export const Route = createFileRoute("/_shell/all-projects")({ component: AllProjectsBoard });
