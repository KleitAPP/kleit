package app.kleit;

import android.content.Intent;
import android.os.Bundle;

import com.getcapacitor.BridgeActivity;

public class MainActivity extends BridgeActivity {
  @Override
  public void onCreate(Bundle savedInstanceState) {
    // Kleit's own native doors, registered before the bridge starts (Capacitor's rule for
    // plugins that live inside the app rather than in a package).
    registerPlugin(CutoutPlugin.class);
    registerPlugin(IncomingPlugin.class);
    super.onCreate(savedInstanceState);
  }

  /** A share or a link arriving while the app is already open (launchMode singleTask). */
  @Override
  protected void onNewIntent(Intent intent) {
    super.onNewIntent(intent);
    setIntent(intent);
    IncomingPlugin.remember(intent);
  }
}
