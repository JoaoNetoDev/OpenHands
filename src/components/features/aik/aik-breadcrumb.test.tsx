import { describe, expect, it } from "vitest";
import { screen } from "@testing-library/react";
import { renderWithProviders } from "test-utils";
import { AikBreadcrumb } from "#/components/features/aik/aik-breadcrumb";

describe("AikBreadcrumb", () => {
  it("renders a single segment (systems root) when no ids are given", () => {
    renderWithProviders(<AikBreadcrumb />);

    expect(screen.getByTestId("aik-breadcrumb-systems")).toHaveAttribute(
      "href",
      "/__aik",
    );
    expect(
      screen.queryByTestId("aik-breadcrumb-system"),
    ).not.toBeInTheDocument();
    expect(
      screen.queryByTestId("aik-breadcrumb-phase"),
    ).not.toBeInTheDocument();
  });

  it("renders two segments when only systemId is given, linking to the system", () => {
    renderWithProviders(<AikBreadcrumb systemId="sys-1" />);

    expect(screen.getByTestId("aik-breadcrumb-systems")).toHaveAttribute(
      "href",
      "/__aik",
    );
    expect(screen.getByTestId("aik-breadcrumb-system")).toHaveAttribute(
      "href",
      "/__aik/sys-1",
    );
    expect(screen.getByTestId("aik-breadcrumb-system")).toHaveTextContent(
      "sys-1",
    );
    expect(
      screen.queryByTestId("aik-breadcrumb-phase"),
    ).not.toBeInTheDocument();
  });

  it("renders three segments when both systemId and phaseId are given", () => {
    renderWithProviders(<AikBreadcrumb systemId="sys-1" phaseId="phase-1" />);

    expect(screen.getByTestId("aik-breadcrumb-systems")).toHaveAttribute(
      "href",
      "/__aik",
    );
    expect(screen.getByTestId("aik-breadcrumb-system")).toHaveAttribute(
      "href",
      "/__aik/sys-1",
    );
    expect(screen.getByTestId("aik-breadcrumb-phase")).toHaveAttribute(
      "href",
      "/__aik/sys-1/fases/phase-1",
    );
    expect(screen.getByTestId("aik-breadcrumb-phase")).toHaveTextContent(
      "phase-1",
    );
  });

  it("omits the phase segment when phaseId is given without systemId", () => {
    renderWithProviders(<AikBreadcrumb phaseId="phase-1" />);

    expect(
      screen.queryByTestId("aik-breadcrumb-system"),
    ).not.toBeInTheDocument();
    expect(
      screen.queryByTestId("aik-breadcrumb-phase"),
    ).not.toBeInTheDocument();
  });
});
