import { createTheme } from "@mui/material/styles";

export const appTheme = createTheme({
  palette: {
    mode: "dark",
    background: {
      default: "#101418",
      paper: "#1a2027",
    },
    primary: {
      main: "#4cc2ff",
      contrastText: "#06121a",
    },
    error: {
      main: "#ff7a7a",
    },
    text: {
      primary: "#e8edf2",
      secondary: "#9aa7b4",
    },
  },
  shape: {
    borderRadius: 12,
  },
  typography: {
    fontFamily: 'system-ui, -apple-system, "Segoe UI", Roboto, sans-serif',
    h1: {
      fontSize: "clamp(1.8rem, 8vw, 2.6rem)",
      fontWeight: 800,
      lineHeight: 1.15,
    },
    h2: {
      fontSize: "1.15rem",
      fontWeight: 700,
    },
    button: {
      fontWeight: 700,
      textTransform: "none",
    },
  },
  components: {
    MuiButton: {
      defaultProps: {
        disableElevation: true,
        size: "large",
        variant: "contained",
      },
      styleOverrides: {
        root: {
          minHeight: 48,
        },
      },
    },
    MuiPaper: {
      styleOverrides: {
        root: {
          backgroundImage: "none",
        },
      },
    },
    MuiTextField: {
      defaultProps: {
        fullWidth: true,
        variant: "outlined",
      },
    },
  },
});
