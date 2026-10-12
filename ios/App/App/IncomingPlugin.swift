import Capacitor
import Foundation

/// What the phone handed the app when it opened it, the iOS half (roadmap M8.7): a kleit.app
/// link tapped in a chat (a universal link, once the Associated Domains entitlement exists with
/// the Apple account - M8.1b) or a `kleit://` address. Same contract as the Android plugin: the
/// last one waits until the web code reads it with `pending()`, and one that arrives while the
/// app is open is announced as `incoming`. Shares from other apps are a share extension (M8.2),
/// a separate target, and are not here yet.
///
/// Capacitor's app delegate turns every open-URL and continue-activity call into a notification;
/// the App plugin listens to the same two, which is why this plugin needs no delegate code.
@objc(IncomingPlugin)
public class IncomingPlugin: CAPPlugin, CAPBridgedPlugin {
    public let identifier = "IncomingPlugin"
    public let jsName = "Incoming"
    public let pluginMethods: [CAPPluginMethod] = [
        CAPPluginMethod(name: "pending", returnType: CAPPluginReturnPromise),
    ]

    private var pendingUrl: String?

    override public func load() {
        NotificationCenter.default.addObserver(self, selector: #selector(opened(_:)), name: Notification.Name.capacitorOpenURL, object: nil)
        NotificationCenter.default.addObserver(self, selector: #selector(continued(_:)), name: Notification.Name.capacitorOpenUniversalLink, object: nil)
    }

    deinit {
        NotificationCenter.default.removeObserver(self)
    }

    @objc private func opened(_ notification: Notification) {
        guard let object = notification.object as? [String: Any], let url = object["url"] as? URL else { return }
        remember(url)
    }

    @objc private func continued(_ notification: Notification) {
        guard let object = notification.object as? [String: Any], let url = object["url"] as? URL else { return }
        remember(url)
    }

    /// Only the links the app registers: https, one of our hosts, a set, a poll or an invite.
    /// Anything else that reaches the app as a URL is not kept, so nothing outside the app can
    /// choose a screen for it (the app-code review, 2026-10-12).
    private func isOurLink(_ url: URL) -> Bool {
        guard url.scheme == "https", let host = url.host else { return false }
        let ours = ["kleit.app", "www.kleit.app", "kleit-test.kleitapp-team.workers.dev"]
        guard ours.contains(host) else { return false }
        let path = url.path
        if path.range(of: "^/[sp]/[A-Za-z0-9]{8,32}/?$", options: .regularExpression) != nil { return true }
        if path == "/welcome", let items = URLComponents(url: url, resolvingAgainstBaseURL: false)?.queryItems {
            return items.contains { $0.name == "invite" && !($0.value ?? "").isEmpty }
        }
        return false
    }

    private func remember(_ url: URL) {
        guard isOurLink(url) else { return }
        pendingUrl = url.absoluteString
        notifyListeners("incoming", data: take(), retainUntilConsumed: true)
    }

    private func take() -> [String: Any] {
        var ret: [String: Any] = [:]
        if let url = pendingUrl { ret["url"] = url }
        pendingUrl = nil
        return ret
    }

    @objc func pending(_ call: CAPPluginCall) {
        call.resolve(take())
    }
}
