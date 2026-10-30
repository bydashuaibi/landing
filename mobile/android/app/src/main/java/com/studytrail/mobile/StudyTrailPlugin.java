package com.studytrail.mobile;

import android.content.*;
import android.provider.Settings;
import android.service.notification.NotificationListenerService;
import androidx.core.app.NotificationManagerCompat;
import com.getcapacitor.*;
import com.getcapacitor.annotation.CapacitorPlugin;
import org.json.*;

@CapacitorPlugin(name="StudyTrailNative")
public class StudyTrailPlugin extends Plugin {
    private SharedPreferences prefs(){return getContext().getSharedPreferences("studytrail-native",0);}
    @PluginMethod public void status(PluginCall call){JSObject o=new JSObject();o.put("granted",NotificationManagerCompat.getEnabledListenerPackages(getContext()).contains(getContext().getPackageName()));o.put("connected",PaymentListener.connected);o.put("enabled",prefs().getBoolean("capture",false));o.put("lastCaptured",prefs().getLong("lastCaptured",0));o.put("error",prefs().getBoolean("captureError",false));call.resolve(o);}
    @PluginMethod public void configure(PluginCall call){boolean enabled=Boolean.TRUE.equals(call.getBoolean("enabled",false));prefs().edit().putBoolean("capture",enabled).putBoolean("captureError",false).commit();if(enabled)NotificationListenerService.requestRebind(new ComponentName(getContext(),PaymentListener.class));call.resolve();}
    @PluginMethod public void openAccess(PluginCall call){getActivity().startActivity(new Intent(Settings.ACTION_NOTIFICATION_LISTENER_SETTINGS));call.resolve();}
    @PluginMethod public void openAppSettings(PluginCall call){getActivity().startActivity(new Intent(Settings.ACTION_APPLICATION_DETAILS_SETTINGS,android.net.Uri.parse("package:"+getContext().getPackageName())));call.resolve();}
    @PluginMethod public void events(PluginCall call){try(CaptureStore store=new CaptureStore(getContext())){JSObject o=new JSObject();o.put("events",store.pending());call.resolve(o);}catch(Exception e){call.reject("Could not read payment queue");}}
    @PluginMethod public void acknowledge(PluginCall call){JSArray ids=call.getArray("ids");if(ids==null||ids.length()>100){call.reject("Invalid IDs");return;}try(CaptureStore store=new CaptureStore(getContext())){store.ack(ids);call.resolve();}catch(Exception e){call.reject("Could not acknowledge payment queue");}}
    @PluginMethod public void loadState(PluginCall call){JSObject o=new JSObject();o.put("json",prefs().getString("state",null));call.resolve(o);}
    @PluginMethod public void saveState(PluginCall call){String json=call.getString("json");try{if(json==null||json.length()>8000000||!(new JSONObject(json).optJSONObject("ledger") instanceof JSONObject))throw new Exception();if(!prefs().edit().putString("state",json).commit())throw new Exception();call.resolve();}catch(Exception e){call.reject("Could not save app data");}}
}
