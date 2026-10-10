import Capacitor
import CoreImage
import Foundation
import UIKit
import Vision

/// The phone's own cutout on iOS (roadmap M8.3; spec 4.4 #6): Vision's foreground-instance mask
/// (iOS 17+), run on the device with no server call. Same contract as the Android plugin: a
/// prepared JPEG in, a grey PNG the same size out - white where the piece is, black where the
/// background is - which the web eraser takes as its starting mask.
@objc(CutoutPlugin)
public class CutoutPlugin: CAPPlugin, CAPBridgedPlugin {
    public let identifier = "CutoutPlugin"
    public let jsName = "Cutout"
    public let pluginMethods: [CAPPluginMethod] = [
        CAPPluginMethod(name: "available", returnType: CAPPluginReturnPromise),
        CAPPluginMethod(name: "mask", returnType: CAPPluginReturnPromise),
    ]

    @objc func available(_ call: CAPPluginCall) {
        if #available(iOS 17.0, *) {
            call.resolve(["available": true])
        } else {
            call.resolve(["available": false])
        }
    }

    @objc func mask(_ call: CAPPluginCall) {
        guard let data64 = call.getString("jpegBase64"),
              let data = Data(base64Encoded: data64),
              let image = UIImage(data: data),
              let cg = image.cgImage
        else {
            call.reject("unreadable")
            return
        }
        guard #available(iOS 17.0, *) else {
            call.reject("unsupported")
            return
        }
        DispatchQueue.global(qos: .userInitiated).async {
            let request = VNGenerateForegroundInstanceMaskRequest()
            let handler = VNImageRequestHandler(cgImage: cg, options: [:])
            do {
                try handler.perform([request])
                guard let result = request.results?.first else {
                    call.reject("no subject")
                    return
                }
                // The mask at the photo's own size, one float per pixel, 0 = background.
                let buffer = try result.generateScaledMaskForImage(forInstances: result.allInstances, from: handler)
                let grey = CIImage(cvPixelBuffer: buffer)
                let context = CIContext(options: [.workingColorSpace: NSNull()])
                guard let png = context.pngRepresentation(
                    of: grey,
                    format: .RGBA8,
                    colorSpace: CGColorSpaceCreateDeviceRGB(),
                    options: [:]
                ) else {
                    call.reject("mask failed")
                    return
                }
                call.resolve([
                    "maskBase64": png.base64EncodedString(),
                    "width": cg.width,
                    "height": cg.height,
                ])
            } catch {
                call.reject("segmentation failed: \(error.localizedDescription)")
            }
        }
    }
}
