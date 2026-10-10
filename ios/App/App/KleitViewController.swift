import Capacitor
import UIKit

/// The bridge with Kleit's own native doors registered (Capacitor's way for plugins that live
/// inside the app). Main.storyboard points its view controller at this class.
class KleitViewController: CAPBridgeViewController {
    override open func capacitorDidLoad() {
        bridge?.registerPluginInstance(CutoutPlugin())
    }
}
