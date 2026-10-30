package com.studytrail.mobile;

import java.math.BigDecimal;
import java.util.regex.*;

/** Pure rules: no chat text, notification body, or account data is persisted. */
public final class PaymentRules {
    public static final class Result {
        public final String source, kind, type;
        public final long cents;
        Result(String s,String k,String t,long c){source=s;kind=k;type=t;cents=c;}
    }
    public static Result parse(String pkg,String title,String body){
        String source=pkg.equals("com.tencent.mm")?"wechat":pkg.equals("com.eg.android.AlipayGphone")?"alipay":null;
        if(source==null||title==null||body==null)return null;
        if(!title.matches("^(微信支付|微信收款助手|支付助手|支付宝|支付宝支付|支付通知|交易通知)([\\s·:：].*)?$"))return null;
        String text=body.replace(',', '，');
        if(text.matches("(?s).*(验证码|校验码|付款失败|支付失败|交易关闭|待支付|等待付款|红包|营销|优惠券).*"))return null;
        String kind="payment";
        if(Pattern.compile("退款成功|退款到账|已退款").matcher(text).find())kind="refund";
        else if(Pattern.compile("转账成功|转账到账|转账收款").matcher(text).find())kind="transfer";
        else if(!Pattern.compile("支付成功|付款成功|成功支付|成功付款|扣款成功|收款到账|收款成功").matcher(text).find())return null;
        String type=kind.equals("refund")||Pattern.compile("收款到账|收款成功").matcher(text).find()?"income":kind.equals("transfer")?"transfer":"expense";
        // Require a currency marker, and reject multiple amounts (e.g. paid amount + balance).
        Matcher m=Pattern.compile("(?<![\\d.,，-])(?:[¥￥]\\s*(\\d{1,7}(?:\\.\\d{1,2})?)(?![\\d.,，])|(\\d{1,7}(?:\\.\\d{1,2})?)\\s*元)").matcher(text);
        long cents=0;int count=0;
        while(m.find()){count++;try{cents=new BigDecimal(m.group(1)!=null?m.group(1):m.group(2)).movePointRight(2).longValueExact();}catch(Exception e){return null;}}
        if(count!=1||cents<=0||cents>999999999)cents=0;
        return new Result(source,kind,type,cents);
    }
}
