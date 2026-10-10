package app.kleit;

import android.graphics.Bitmap;
import android.graphics.BitmapFactory;
import android.util.Base64;

import com.getcapacitor.JSObject;
import com.getcapacitor.Plugin;
import com.getcapacitor.PluginCall;
import com.getcapacitor.PluginMethod;
import com.getcapacitor.annotation.CapacitorPlugin;
import com.google.mlkit.vision.common.InputImage;
import com.google.mlkit.vision.segmentation.subject.SubjectSegmentation;
import com.google.mlkit.vision.segmentation.subject.SubjectSegmenter;
import com.google.mlkit.vision.segmentation.subject.SubjectSegmenterOptions;

import java.io.ByteArrayOutputStream;
import java.nio.FloatBuffer;

/**
 * The phone's own cutout (roadmap M8.3; spec 4.4 #6): ML Kit's subject segmentation, run on the
 * device, with no server call. The photo comes in as the prepared JPEG the web code already
 * made (oriented, capped, no metadata) and goes back as a grey PNG the same size - white where
 * the piece is, black where the background is - which the web eraser (src/photos/cutout.ts)
 * takes as its starting mask. The same two brushes fix whatever the model got wrong.
 *
 * The model is downloaded by Google Play services the first time (about 200 KB of our own code;
 * the manifest asks for it at install). A phone without Play services, or before the download
 * has finished, gets a rejection and the app falls back to the plain eraser.
 */
@CapacitorPlugin(name = "Cutout")
public class CutoutPlugin extends Plugin {

  @PluginMethod
  public void available(PluginCall call) {
    JSObject ret = new JSObject();
    ret.put("available", true);
    call.resolve(ret);
  }

  @PluginMethod
  public void mask(PluginCall call) {
    String data = call.getString("jpegBase64");
    if (data == null || data.isEmpty()) {
      call.reject("no image");
      return;
    }
    final Bitmap bitmap;
    try {
      byte[] bytes = Base64.decode(data, Base64.DEFAULT);
      bitmap = BitmapFactory.decodeByteArray(bytes, 0, bytes.length);
    } catch (IllegalArgumentException e) {
      call.reject("unreadable");
      return;
    }
    if (bitmap == null) {
      call.reject("unreadable");
      return;
    }

    SubjectSegmenterOptions options =
        new SubjectSegmenterOptions.Builder().enableForegroundConfidenceMask().build();
    final SubjectSegmenter segmenter = SubjectSegmentation.getClient(options);
    InputImage image = InputImage.fromBitmap(bitmap, 0);
    segmenter
        .process(image)
        .addOnSuccessListener(
            result -> {
              try {
                FloatBuffer confidence = result.getForegroundConfidenceMask();
                int width = bitmap.getWidth();
                int height = bitmap.getHeight();
                if (confidence == null || confidence.capacity() < width * height) {
                  call.reject("no subject");
                  return;
                }
                confidence.rewind();
                int[] pixels = new int[width * height];
                for (int i = 0; i < width * height; i++) {
                  int v = Math.max(0, Math.min(255, Math.round(confidence.get() * 255f)));
                  pixels[i] = 0xFF000000 | (v << 16) | (v << 8) | v;
                }
                Bitmap grey = Bitmap.createBitmap(pixels, width, height, Bitmap.Config.ARGB_8888);
                ByteArrayOutputStream out = new ByteArrayOutputStream();
                grey.compress(Bitmap.CompressFormat.PNG, 100, out);
                JSObject ret = new JSObject();
                ret.put("maskBase64", Base64.encodeToString(out.toByteArray(), Base64.NO_WRAP));
                ret.put("width", width);
                ret.put("height", height);
                call.resolve(ret);
              } catch (RuntimeException e) {
                call.reject("mask failed: " + e.getMessage());
              } finally {
                segmenter.close();
              }
            })
        .addOnFailureListener(
            e -> {
              segmenter.close();
              call.reject("segmentation failed: " + e.getMessage());
            });
  }
}
