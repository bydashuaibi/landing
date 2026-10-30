package com.studytrail.mobile;

import com.getcapacitor.BridgeActivity;
import android.os.Bundle;

public class MainActivity extends BridgeActivity {
    @Override public void onCreate(Bundle savedInstanceState){
        registerPlugin(StudyTrailPlugin.class);
        super.onCreate(savedInstanceState);
    }
}
