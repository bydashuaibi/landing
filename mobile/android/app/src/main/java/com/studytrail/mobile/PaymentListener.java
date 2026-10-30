package com.studytrail.mobile;

import android.app.Notification;
import android.service.notification.*;
import android.os.Bundle;
import org.json.JSONObject;
import java.security.MessageDigest;
import java.nio.charset.StandardCharsets;

public class PaymentListener extends NotificationListenerService {
    static volatile boolean connected=false;
    @Override public void onListenerConnected(){connected=true;}
    @Override public void onListenerDisconnected(){connected=false;}
    @Override public void onDestroy(){connected=false;super.onDestroy();}
    @Override public void onNotificationPosted(StatusBarNotification sbn){
        if(sbn==null||!getSharedPreferences("studytrail-native",MODE_PRIVATE).getBoolean("capture",false))return;
        Notification n=sbn.getNotification();if(n==null||(n.flags&Notification.FLAG_GROUP_SUMMARY)!=0)return;
        Bundle b=n.extras;if(b==null)return;
        CharSequence title=b.getCharSequence(Notification.EXTRA_TITLE),body=b.getCharSequence(Notification.EXTRA_BIG_TEXT);
        if(body==null)body=b.getCharSequence(Notification.EXTRA_TEXT);
        PaymentRules.Result r=PaymentRules.parse(sbn.getPackageName(),title==null?"":title.toString(),body==null?"":body.toString());if(r==null)return;
        try(CaptureStore store=new CaptureStore(this)){
            // A notification update with the same key/time/amount remains one event.
            long eventTime=n.when>0&&n.when<=System.currentTimeMillis()+60000?n.when:sbn.getPostTime();
            String seed=sbn.getKey()+"|"+eventTime+"|"+r.type+"|"+r.cents;
            byte[] hash=MessageDigest.getInstance("SHA-256").digest(seed.getBytes(StandardCharsets.UTF_8));StringBuilder hex=new StringBuilder();for(byte x:hash)hex.append(String.format("%02x",x&255));
            String id="notification:"+hex;
            JSONObject event=new JSONObject().put("id",id).put("source",r.source).put("kind",r.kind).put("type",r.type).put("cents",r.cents).put("at",sbn.getPostTime());
            store.insert(id,event,sbn.getPostTime());getSharedPreferences("studytrail-native",MODE_PRIVATE).edit().putLong("lastCaptured",System.currentTimeMillis()).apply();
        }catch(Exception e){getSharedPreferences("studytrail-native",MODE_PRIVATE).edit().putBoolean("captureError",true).apply();}
    }
}
