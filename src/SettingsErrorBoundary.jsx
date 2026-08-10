import { Component } from "react";

export default class SettingsErrorBoundary extends Component {
  state = { failed: false };

  static getDerivedStateFromError() {
    return { failed: true };
  }

  retry = () => {
    this.setState({ failed: false });
    this.props.onRetry?.();
  };

  render() {
    if (!this.state.failed) return this.props.children;
    const { styles, t } = this.props;
    return <div style={styles.privacyDetails} role="alert" aria-live="assertive">
      <p style={styles.privacyText}>{t("settingsLoadError")}</p>
      <button type="button" style={styles.secondaryBtn} onClick={this.retry}>{t("retrySettings")}</button>
    </div>;
  }
}
