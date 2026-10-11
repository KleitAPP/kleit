package app.kleit;

import android.content.Intent;
import android.net.Uri;

import com.getcapacitor.JSObject;
import com.getcapacitor.Plugin;
import com.getcapacitor.PluginCall;
import com.getcapacitor.PluginMethod;
import com.getcapacitor.annotation.CapacitorPlugin;

/**
 * What the phone handed the app when it opened it (roadmap M8.2 and M8.7, the Android half):
 *
 *   - a share from another app (ACTION_SEND, text/plain - a store app's "Share" puts the product
 *     page's address in the text), which becomes "Clip a link" with the address filled in;
 *   - an address of ours tapped in a chat (ACTION_VIEW on a kleit.app link, once the domain and
 *     its assetlinks.json exist), which becomes the set or poll inside the app.
 *
 * The web code asks `pending()` on start and on every return to the foreground, and also hears
 * `incoming` the moment a new intent arrives while the app is already open. One intent is
 * handed over once: reading it clears it, so a share is never clipped twice.
 */
@CapacitorPlugin(name = "Incoming")
public class IncomingPlugin extends Plugin {

  private static String pendingText = null;
  private static String pendingUrl = null;
  private static IncomingPlugin live = null;

  /** Called by MainActivity for the launch intent and every new one. */
  static void remember(Intent intent) {
    if (intent == null) return;
    String action = intent.getAction();
    if (Intent.ACTION_SEND.equals(action) && "text/plain".equals(intent.getType())) {
      String text = intent.getStringExtra(Intent.EXTRA_TEXT);
      if (text != null && !text.trim().isEmpty()) {
        pendingText = text.trim();
        pendingUrl = null;
      }
    } else if (Intent.ACTION_VIEW.equals(action)) {
      Uri data = intent.getData();
      if (data != null) {
        pendingUrl = data.toString();
        pendingText = null;
      }
    }
    if (live != null && (pendingText != null || pendingUrl != null)) live.announce();
  }

  @Override
  public void load() {
    // The launch intent is remembered quietly: the web code asks for it with `pending()` once
    // it is up. Only intents that arrive after this are announced as they come.
    live = null;
    if (getActivity() != null) remember(getActivity().getIntent());
    live = this;
  }

  private void announce() {
    notifyListeners("incoming", take(), true);
  }

  private static JSObject take() {
    JSObject ret = new JSObject();
    if (pendingText != null) ret.put("text", pendingText);
    if (pendingUrl != null) ret.put("url", pendingUrl);
    pendingText = null;
    pendingUrl = null;
    return ret;
  }

  @PluginMethod
  public void pending(PluginCall call) {
    call.resolve(take());
  }
}
