package com.studytrail.mobile;

import android.content.*;
import android.database.Cursor;
import android.database.sqlite.*;
import org.json.*;

public final class CaptureStore extends SQLiteOpenHelper {
    public CaptureStore(Context c){super(c,"payment-events.db",null,1);}
    @Override public void onCreate(SQLiteDatabase db){db.execSQL("CREATE TABLE events (id TEXT PRIMARY KEY, payload TEXT NOT NULL, at INTEGER NOT NULL, ack INTEGER NOT NULL DEFAULT 0)");}
    @Override public void onUpgrade(SQLiteDatabase db,int oldV,int newV){}
    public void insert(String id,JSONObject obj,long at){ContentValues v=new ContentValues();v.put("id",id);v.put("payload",obj.toString());v.put("at",at);getWritableDatabase().insertWithOnConflict("events",null,v,SQLiteDatabase.CONFLICT_IGNORE);}
    public JSONArray pending() throws JSONException {JSONArray out=new JSONArray();try(Cursor c=getReadableDatabase().rawQuery("SELECT payload FROM events WHERE ack=0 ORDER BY at LIMIT 100",null)){while(c.moveToNext())out.put(new JSONObject(c.getString(0)));}return out;}
    public void ack(JSONArray ids){SQLiteDatabase db=getWritableDatabase();db.beginTransaction();try{ContentValues v=new ContentValues();v.put("ack",1);for(int i=0;i<ids.length();i++)db.update("events",v,"id=?",new String[]{ids.optString(i)});db.setTransactionSuccessful();}finally{db.endTransaction();}}
}
